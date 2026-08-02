package httpapi

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// This guard exists because owner-scoping was previously enforced by
// per-handler discipline, and seven handlers forgot (see the deferred list in
// AGENTS.md 11). Those leaked nothing while Kuraki had one user, and would
// have leaked cross-owner data the moment it had two. Discipline does not
// scale; a failing build does.
//
// Scope is deliberately internal/httpapi only. Background workers in
// internal/app (geocode backfill, FTS reindex, derivative rebuild) operate
// server-wide by design -- they maintain every owner's data -- so holding
// them to this rule would produce noise with no security value.

// ownedTableRe matches a statement touching owner-owned rows. The trailing
// \b matters: without it "assets_fts" (a derived search index, keyed by an
// already-verified asset id) matches "assets" and trips the guard.
var ownedTableRe = regexp.MustCompile(`(?is)\b(?:FROM|UPDATE|INTO)\s+(assets|albums)\b`)

// allowedUnscopedSQL lists SQL that is deliberately library-wide. Entries are
// keyed "file.go|distinctive fragment" -- the file matters as much as the
// text. Keying by text alone let stats.go silently inherit metrics.go's
// exemption for a byte-identical COUNT, which is precisely the regression
// this guard exists to catch.
//
// Every entry states why. Adding one is a design decision about who may
// observe whose data -- not a way to quiet a failing test.
var allowedUnscopedSQL = map[string]string{
	"albums.go|WHERE aa.album_id = ? AND a.deleted_at IS NULL": "albumAssets resolves the album through an owner-checked lookup first; " +
		"album_assets can only ever contain that album's owner's assets because every add path is owner-guarded",
	"metrics.go|SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL":                    "ops-level gauge, deliberately whole-server and token-gated",
	"metrics.go|SELECT COUNT(*) FROM assets WHERE deleted_at IS NOT NULL":                "ops gauge, whole-server by design",
	"metrics.go|SELECT COALESCE(SUM(size_bytes),0) FROM assets WHERE deleted_at IS NULL": "ops gauge, whole-server by design",
	"edit.go|SELECT filename, camera_model, taken_at, description, ocr_text FROM assets WHERE id = ?": "rebuildAssetFTS is an internal helper; every caller has already " +
		"owner-verified the id, and it only rewrites that same asset's search row",
}

// allowedDynamicWhere lists functions that build their WHERE clause at
// runtime, so the guard cannot read it statically. Each is covered by a
// cross-owner isolation test in owner_scope_test.go.
var allowedDynamicWhere = map[string]string{
	"listAssets":      "builds WHERE from query params; every branch begins owner_id = ? (see assets.go). Covered by TestListAssetsOwnerScoped",
	"respondFiltered": "appends a.owner_id = ? unconditionally after the parsed filters (filters.go). Covered by the filters owner-scope tests",
}

// TestNoUnscopedAssetSQL fails when a handler queries owner-owned tables
// without an owner_id predicate.
func TestNoUnscopedAssetSQL(t *testing.T) {
	fset := token.NewFileSet()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		checked++
		checkFile(t, fset, file, name)
	}
	if checked == 0 {
		t.Fatal("guard scanned no files -- it cannot be protecting anything")
	}
}

func checkFile(t *testing.T, fset *token.FileSet, file *ast.File, name string) {
	t.Helper()
	var currentFunc string
	// Literals already reported as part of a concatenation. Descent must
	// continue into concatenations regardless (a call like
	// assetSelectSQL(...)+" LIMIT ?" hides the call inside one), so the
	// fragments are suppressed by marking rather than by halting the walk.
	covered := map[ast.Node]bool{}
	ast.Inspect(file, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.FuncDecl:
			currentFunc = node.Name.Name
		case *ast.CallExpr:
			checkAssetSelectCall(t, fset, node, name, currentFunc)
		case *ast.BinaryExpr:
			// A query assembled by concatenation ("... FROM assets WHERE x = "
			// + col + " AND owner_id = ?") splits the predicate across
			// operands, so judge the joined static parts rather than each
			// fragment alone.
			if node.Op == token.ADD && !covered[node] {
				if joined := staticParts(node); joined != "" {
					checkSQL(t, fset, node.Pos(), joined, name)
					markCovered(node, covered)
				}
			}
		case *ast.BasicLit:
			if node.Kind == token.STRING && !covered[node] {
				if sql, err := strconv.Unquote(node.Value); err == nil {
					checkSQL(t, fset, node.Pos(), sql, name)
				}
			}
		}
		return true
	})
}

// markCovered records every string operand of a concatenation that has
// already been judged as part of the joined whole.
func markCovered(expr ast.Expr, covered map[ast.Node]bool) {
	switch e := expr.(type) {
	case *ast.BasicLit:
		covered[e] = true
	case *ast.BinaryExpr:
		covered[e] = true
		markCovered(e.X, covered)
		markCovered(e.Y, covered)
	}
}

// checkSQL enforces the rule on one resolved SQL string.
func checkSQL(t *testing.T, fset *token.FileSet, pos token.Pos, sql, file string) {
	t.Helper()
	// The builders' own bodies are deliberately NOT exempted. Their WHERE
	// arrives from the caller (checked in checkAssetSelectCall), but the
	// literal also carries the correlated stack_size subquery -- which is
	// owner-scoped and must stay that way. Exempting the body would let a
	// regression there pass unnoticed.
	if !ownedTableRe.MatchString(sql) || strings.Contains(sql, "owner_id") {
		return
	}
	if allowlisted(file, sql) {
		return
	}
	t.Errorf("%s: SQL touches owner-owned rows with no owner_id predicate:\n\t%s\n"+
		"Add the predicate, or add an entry to allowedUnscopedSQL with a reason.",
		fset.Position(pos), strings.TrimSpace(sql))
}

// allowlisted reports whether this file is permitted to run this query.
// Both halves of the key must match.
func allowlisted(file, sql string) bool {
	for key := range allowedUnscopedSQL {
		keyFile, fragment, ok := strings.Cut(key, "|")
		if !ok || keyFile != file {
			continue
		}
		if strings.Contains(normalize(sql), normalize(fragment)) {
			return true
		}
	}
	return false
}

// checkAssetSelectCall enforces the rule on the composed query builders,
// where "FROM assets" lives in the builder and the WHERE clause arrives as an
// argument. A literal-only check would miss these entirely.
func checkAssetSelectCall(t *testing.T, fset *token.FileSet, call *ast.CallExpr, name, currentFunc string) {
	t.Helper()
	fn, ok := call.Fun.(*ast.Ident)
	if !ok {
		return
	}
	if fn.Name != "assetSelectSQL" && fn.Name != "assetSelectSQLWithJoin" {
		return
	}
	// assetSelectSQL delegates to assetSelectSQLWithJoin, forwarding its own
	// where parameter. That is plumbing, not a query -- the real call sites
	// are the ones outside the builders.
	if currentFunc == "assetSelectSQL" || currentFunc == "assetSelectSQLWithJoin" {
		return
	}
	if len(call.Args) == 0 {
		return
	}
	where := call.Args[len(call.Args)-1]
	clause, static := staticString(where)
	if !static {
		// Functions that assemble the whole predicate list at runtime stay on
		// the allowlist -- their static text is bare "WHERE ", which says
		// nothing either way, so they are covered by isolation tests instead.
		if _, allowed := allowedDynamicWhere[currentFunc]; allowed {
			return
		}
		// Otherwise a WHERE assembled by concatenation is still readable:
		// judge its statically-known fragments, exactly as the inline-SQL
		// branch in checkFile does. The list endpoints append a keyset
		// pagination predicate (see cursorPredicate) to a literal that already
		// carries owner_id, and that literal is what matters -- a fragment
		// ANDed on afterwards can narrow the result, never widen it past the
		// owner scope.
		//
		// Deliberately only for concatenations. A WHERE hidden entirely behind
		// a variable or a call still fails below, because there the guard
		// genuinely cannot see the predicate.
		if joined := staticParts(where); joined != "" {
			clause, static = joined, true
		}
	}
	if !static {
		t.Errorf("%s: %s builds a dynamic WHERE for %s that the guard cannot verify.\n"+
			"Either use a literal containing owner_id, or add %q to allowedDynamicWhere with a reason "+
			"and a cross-owner isolation test.",
			fset.Position(call.Pos()), currentFunc, fn.Name, currentFunc)
		return
	}
	if strings.Contains(clause, "owner_id") || allowlisted(name, clause) {
		return
	}
	t.Errorf("%s: %s WHERE clause has no owner_id predicate:\n\t%s",
		fset.Position(call.Pos()), fn.Name, strings.TrimSpace(clause))
}

// staticParts joins every statically-known fragment of a concatenation,
// ignoring dynamic operands. A query whose owner_id predicate sits in a later
// operand than its "FROM assets" still reads as scoped.
func staticParts(expr ast.Expr) string {
	switch e := expr.(type) {
	case *ast.BasicLit:
		if e.Kind != token.STRING {
			return ""
		}
		s, err := strconv.Unquote(e.Value)
		if err != nil {
			return ""
		}
		return s
	case *ast.BinaryExpr:
		if e.Op != token.ADD {
			return ""
		}
		return staticParts(e.X) + staticParts(e.Y)
	}
	return ""
}

// staticString resolves a literal or a concatenation of literals. It reports
// false as soon as any operand is not statically known.
func staticString(expr ast.Expr) (string, bool) {
	switch e := expr.(type) {
	case *ast.BasicLit:
		if e.Kind != token.STRING {
			return "", false
		}
		s, err := strconv.Unquote(e.Value)
		if err != nil {
			return "", false
		}
		return s, true
	case *ast.BinaryExpr:
		if e.Op != token.ADD {
			return "", false
		}
		left, ok := staticString(e.X)
		if !ok {
			return "", false
		}
		right, ok := staticString(e.Y)
		if !ok {
			return "", false
		}
		return left + right, true
	}
	return "", false
}

// normalize collapses whitespace so a fragment match survives reformatting.
func normalize(s string) string { return strings.Join(strings.Fields(s), " ") }

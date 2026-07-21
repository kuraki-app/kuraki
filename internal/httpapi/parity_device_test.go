package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kuraki-app/kuraki/internal/db"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/media"
	"github.com/kuraki-app/kuraki/internal/queue"
	"github.com/kuraki-app/kuraki/internal/storage"
)

// seedSecondOwnerAlbum inserts a second user and an album they own, returning the album id.
func seedSecondOwnerAlbum(t *testing.T, db *sql.DB) string {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO users (id, username, password_hash) VALUES ('other','other','x')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO albums (id, owner_id, name) VALUES ('other-album','other','Theirs')`); err != nil {
		t.Fatal(err)
	}
	return "other-album"
}

func deviceGet(t *testing.T, router http.Handler, token, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func deviceJSON(t *testing.T, router http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestDeviceAlbumsCreateListGet(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAsset(t, db, "a1")

	// create
	create := deviceJSON(t, router, http.MethodPost, "/api/albums", token, map[string]string{"name": "Trip"})
	if create.Code != http.StatusCreated {
		t.Fatalf("create album = %d body=%s", create.Code, create.Body.String())
	}
	var made struct {
		ID string `json:"id"`
	}
	json.Unmarshal(create.Body.Bytes(), &made)
	if made.ID == "" {
		t.Fatal("no album id")
	}
	// add asset
	add := deviceJSON(t, router, http.MethodPost, "/api/albums/"+made.ID+"/assets", token, map[string][]string{"ids": {"a1"}})
	if add.Code != http.StatusOK {
		t.Fatalf("add = %d body=%s", add.Code, add.Body.String())
	}
	// list shows it
	list := deviceGet(t, router, token, "/api/albums")
	if list.Code != http.StatusOK || !bytes.Contains(list.Body.Bytes(), []byte("Trip")) {
		t.Fatalf("list = %d body=%s", list.Code, list.Body.String())
	}
	// get returns its asset
	get := deviceGet(t, router, token, "/api/albums/"+made.ID)
	if get.Code != http.StatusOK || !bytes.Contains(get.Body.Bytes(), []byte("a1")) {
		t.Fatalf("get = %d body=%s", get.Code, get.Body.String())
	}
}

func TestDeviceAlbumsRejectNoToken(t *testing.T) {
	router, _, _ := deviceFavoriteRouter(t)
	if rec := deviceGet(t, router, "", "/api/albums"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no-token albums = %d, want 401", rec.Code)
	}
}

// deviceTrashTestRouter is deviceFavoriteRouter's setup with the underlying
// storage.Storage also returned, so trash tests can write a real original
// file (trash.Delete moves it on disk, unlike the favorite endpoint).
func deviceTrashTestRouter(t *testing.T) (http.Handler, *http.Cookie, *sql.DB, storage.Storage) {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	database, err := db.Open(ctx, filepath.Join(root, "kuraki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database, nil); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewFS(root)
	if err != nil {
		t.Fatal(err)
	}
	q, err := queue.New(database, store, media.NewPureGo(), 0, filepath.Join(root, "staging"), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(Deps{Version: "test", DB: database, Store: store, Queue: q, Logger: slog.Default()})
	cookie := setupTestSession(t, router)
	return router, cookie, database, store
}

// seedOwnedAssetFile is seedOwnedAsset plus the physical original file that
// trash.Delete needs to move on disk.
func seedOwnedAssetFile(t *testing.T, ctx context.Context, database *sql.DB, store storage.Storage, id string) {
	t.Helper()
	seedOwnedAsset(t, database, id)
	if _, err := store.Write(ctx, "originals/2026/07/"+id+".jpg", strings.NewReader("bytes-"+id)); err != nil {
		t.Fatal(err)
	}
}

func TestDeviceTrashLifecycle(t *testing.T) {
	ctx := context.Background()
	router, cookie, db, store := deviceTrashTestRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAssetFile(t, ctx, db, store, "t1")

	// trash it
	del := deviceJSON(t, router, http.MethodDelete, "/api/assets/t1", token, nil)
	if del.Code != http.StatusOK {
		t.Fatalf("trash = %d body=%s", del.Code, del.Body.String())
	}
	// appears in trash list
	list := deviceGet(t, router, token, "/api/trash")
	if list.Code != http.StatusOK || !bytes.Contains(list.Body.Bytes(), []byte("t1")) {
		t.Fatalf("trash list = %d body=%s", list.Code, list.Body.String())
	}
	// restore
	res := deviceJSON(t, router, http.MethodPost, "/api/assets/t1/restore", token, nil)
	if res.Code != http.StatusOK {
		t.Fatalf("restore = %d body=%s", res.Code, res.Body.String())
	}
	// purge on a now-live asset conflicts
	purge := deviceJSON(t, router, http.MethodDelete, "/api/trash/t1", token, nil)
	if purge.Code != http.StatusConflict {
		t.Fatalf("purge live = %d, want 409", purge.Code)
	}
}

// TestDeviceGetAsset covers the single-asset refetch the delta feed depends on:
// the feed is thin, so a device seeing a change re-reads the asset here.
func TestDeviceGetAsset(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	seedOwnedAsset(t, db, "a1")

	rec := deviceGet(t, router, token, "/api/assets/a1")
	if rec.Code != http.StatusOK {
		t.Fatalf("get asset = %d body=%s", rec.Code, rec.Body.String())
	}
	var got apitypes.Asset
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != "a1" {
		t.Fatalf("asset id = %q, want a1", got.ID)
	}

	// missing asset -> 404
	if miss := deviceGet(t, router, token, "/api/assets/nope"); miss.Code != http.StatusNotFound {
		t.Fatalf("missing asset = %d, want 404", miss.Code)
	}
	// no token -> 401
	if un := deviceGet(t, router, "", "/api/assets/a1"); un.Code != http.StatusUnauthorized {
		t.Fatalf("no token = %d, want 401", un.Code)
	}
}

func TestDeviceMemoriesRequiresToken(t *testing.T) {
	router, _, _ := deviceFavoriteRouter(t)
	if rec := deviceGet(t, router, "", "/api/memories"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("memories no-token = %d, want 401", rec.Code)
	}
}

// seedSecondOwnerTrashedAsset inserts a second user and a trashed asset they
// own, returning the asset id.
func seedSecondOwnerTrashedAsset(t *testing.T, database *sql.DB, id string) string {
	t.Helper()
	if _, err := database.Exec(`INSERT INTO users (id, username, password_hash) VALUES ('other2','other2','x')`); err != nil {
		t.Fatal(err)
	}
	_, err := database.Exec(`INSERT INTO assets (id, owner_id, content_hash, original_path, filename, mime_type, media_type, deleted_at)
		VALUES (?, 'other2', ?, ?, ?, ?, 'image', CURRENT_TIMESTAMP)`, id, "hash-"+id, "2026/07/"+id+".jpg", id+".jpg", "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestDeviceCannotTouchOtherOwnerTrash(t *testing.T) {
	router, cookie, db, _ := deviceTrashTestRouter(t)
	token := registerTestDevice(t, router, cookie)
	other := seedSecondOwnerTrashedAsset(t, db, "o1")

	if rec := deviceJSON(t, router, http.MethodDelete, "/api/assets/"+other, token, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("other-owner delete = %d, want 404", rec.Code)
	}
	if rec := deviceJSON(t, router, http.MethodPost, "/api/assets/"+other+"/restore", token, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("other-owner restore = %d, want 404", rec.Code)
	}
	if rec := deviceJSON(t, router, http.MethodDelete, "/api/trash/"+other, token, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("other-owner purge = %d, want 404", rec.Code)
	}
}

// seedSecondOwnerAsset inserts a second user and a live asset they own,
// returning the asset id. Mirrors seedOwnedAsset/seedSecondOwnerTrashedAsset
// but without a deleted_at, for endpoints that operate on live assets.
func seedSecondOwnerAsset(t *testing.T, database *sql.DB, id string) string {
	t.Helper()
	if _, err := database.Exec(`INSERT INTO users (id, username, password_hash) VALUES ('other-fav','other-fav','x')`); err != nil {
		t.Fatal(err)
	}
	_, err := database.Exec(`INSERT INTO assets (id, owner_id, content_hash, original_path, filename, mime_type, media_type)
		VALUES (?, 'other-fav', ?, ?, ?, ?, 'image')`, id, "hash-"+id, "2026/07/"+id+".jpg", id+".jpg", "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestDeviceFavoriteCannotReachOtherOwnerAsset(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	other := seedSecondOwnerAsset(t, db, "of1")

	rec := postFavorite(t, router, token, other, true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("other-owner favorite = %d, want 404", rec.Code)
	}
}

// TestDeviceAlbumAddRejectsOtherOwnerAsset guards the one device write that
// wasn't owner-scoped: addAlbumAssets checked album ownership but linked any
// asset_id with no check that the asset itself belongs to the caller. Seed a
// second owner's live asset, POST it into the device's own album, and confirm
// the insert was a silent no-op (foreign asset never appears in the album).
func TestDeviceAlbumAddRejectsOtherOwnerAsset(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	foreign := seedSecondOwnerAsset(t, db, "foreign-asset")

	create := deviceJSON(t, router, http.MethodPost, "/api/albums", token, map[string]string{"name": "Mine"})
	if create.Code != http.StatusCreated {
		t.Fatalf("create album = %d body=%s", create.Code, create.Body.String())
	}
	var made struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(create.Body.Bytes(), &made); err != nil {
		t.Fatal(err)
	}

	add := deviceJSON(t, router, http.MethodPost, "/api/albums/"+made.ID+"/assets", token, map[string][]string{"ids": {foreign}})
	if add.Code != http.StatusOK {
		t.Fatalf("add = %d body=%s", add.Code, add.Body.String())
	}
	var addedResp struct {
		Added int `json:"added"`
	}
	if err := json.Unmarshal(add.Body.Bytes(), &addedResp); err != nil {
		t.Fatal(err)
	}
	if addedResp.Added != 0 {
		t.Fatalf("added = %d, want 0 (foreign asset must not link)", addedResp.Added)
	}

	get := deviceGet(t, router, token, "/api/albums/"+made.ID)
	if get.Code != http.StatusOK {
		t.Fatalf("get = %d body=%s", get.Code, get.Body.String())
	}
	if bytes.Contains(get.Body.Bytes(), []byte(foreign)) {
		t.Fatalf("album contains foreign-owned asset: %s", get.Body.String())
	}
}

// TestDeviceRenameAlbum proves a device token can rename its own album via
// PATCH /api/albums/{id}. Before the fix, renameAlbum resolved the owner via
// d.currentUser(r), which returns nil for a device/Bearer request; deref'ing
// user.ID with no nil check panicked (HTTP 500) instead of succeeding.
func TestDeviceRenameAlbum(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)

	create := deviceJSON(t, router, http.MethodPost, "/api/albums", token, map[string]string{"name": "Trip"})
	if create.Code != http.StatusCreated {
		t.Fatalf("create album = %d body=%s", create.Code, create.Body.String())
	}
	var made struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(create.Body.Bytes(), &made); err != nil {
		t.Fatal(err)
	}

	rename := deviceJSON(t, router, http.MethodPatch, "/api/albums/"+made.ID, token, map[string]string{"name": "Renamed"})
	if rename.Code != http.StatusOK {
		t.Fatalf("rename album = %d body=%s, want 200 (not a panic)", rename.Code, rename.Body.String())
	}
}

// TestDeviceDeleteAlbum proves a device token can delete its own album via
// DELETE /api/albums/{id}. Before the fix, deleteAlbum resolved the owner via
// d.currentUser(r) with no nil check, panicking on a device request.
func TestDeviceDeleteAlbum(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)

	create := deviceJSON(t, router, http.MethodPost, "/api/albums", token, map[string]string{"name": "Trip"})
	if create.Code != http.StatusCreated {
		t.Fatalf("create album = %d body=%s", create.Code, create.Body.String())
	}
	var made struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(create.Body.Bytes(), &made); err != nil {
		t.Fatal(err)
	}

	del := deviceJSON(t, router, http.MethodDelete, "/api/albums/"+made.ID, token, nil)
	if del.Code != http.StatusOK {
		t.Fatalf("delete album = %d body=%s, want 200 (not a panic)", del.Code, del.Body.String())
	}
}

// TestDeviceCreateTag proves a device token can create a tag via POST
// /api/tags. Before the fix, createTag resolved the owner via
// d.currentUser(r), which is nil for a device request, so it 401'd every
// device caller even though the route sits in the both-principals group.
func TestDeviceCreateTag(t *testing.T) {
	router, cookie, _ := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)

	rec := deviceJSON(t, router, http.MethodPost, "/api/tags", token, apitypes.TagRequest{Name: "beach"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create tag = %d body=%s, want 201", rec.Code, rec.Body.String())
	}
}

func TestDeviceCannotReachOtherOwnerAlbum(t *testing.T) {
	router, cookie, db := deviceFavoriteRouter(t)
	token := registerTestDevice(t, router, cookie)
	other := seedSecondOwnerAlbum(t, db)
	if rec := deviceGet(t, router, token, "/api/albums/"+other); rec.Code != http.StatusNotFound {
		t.Fatalf("other-owner album get = %d, want 404", rec.Code)
	}
	add := deviceJSON(t, router, http.MethodPost, "/api/albums/"+other+"/assets", token, map[string][]string{"ids": {"a1"}})
	if add.Code != http.StatusNotFound {
		t.Fatalf("other-owner album add = %d, want 404", add.Code)
	}
}

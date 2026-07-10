package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type tagDTO struct {
	ID, Name string
	ParentID *string `json:"parent_id,omitempty"`
}
type tagRequest struct {
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"`
}
type assetTagsRequest struct {
	IDs []string `json:"ids"`
}
type savedSearchDTO struct {
	ID, Name  string
	Query     json.RawMessage `json:"query"`
	CreatedAt string          `json:"created_at"`
}
type savedSearchRequest struct {
	Name  string          `json:"name"`
	Query json.RawMessage `json:"query"`
}

func (d Deps) listTags(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	rows, err := d.DB.QueryContext(r.Context(), `SELECT id,name,parent_id FROM tags WHERE owner_id=? ORDER BY name`, user.ID)
	if err != nil {
		writeError(w, 500, "query_tags_failed")
		return
	}
	defer rows.Close()
	out := make([]tagDTO, 0)
	for rows.Next() {
		var x tagDTO
		var p *string
		if err := rows.Scan(&x.ID, &x.Name, &p); err != nil {
			writeError(w, 500, "scan_tags_failed")
			return
		}
		x.ParentID = p
		out = append(out, x)
	}
	writeJSON(w, 200, map[string]any{"tags": out})
}
func (d Deps) createTag(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	var req tagRequest
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		writeError(w, 400, "invalid_json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, 400, "tag_name_required")
		return
	}
	id, err := uuid.NewV7()
	if err != nil {
		writeError(w, 500, "tag_id_failed")
		return
	}
	if _, err = d.DB.ExecContext(r.Context(), `INSERT INTO tags(id,owner_id,name,parent_id) VALUES(?,?,?,?)`, id.String(), user.ID, req.Name, req.ParentID); err != nil {
		writeError(w, 409, "tag_exists_or_parent_invalid")
		return
	}
	writeJSON(w, 201, tagDTO{ID: id.String(), Name: req.Name, ParentID: req.ParentID})
}
func (d Deps) deleteTag(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	res, err := d.DB.ExecContext(r.Context(), `DELETE FROM tags WHERE id=? AND owner_id=?`, chi.URLParam(r, "id"), user.ID)
	if err != nil {
		writeError(w, 500, "delete_tag_failed")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, 404, "tag_not_found")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
func (d Deps) assetTags(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := d.DB.QueryContext(r.Context(), `SELECT t.id,t.name,t.parent_id FROM tags t JOIN asset_tags at ON at.tag_id=t.id WHERE at.asset_id=? ORDER BY t.name`, id)
	if err != nil {
		writeError(w, 500, "query_asset_tags_failed")
		return
	}
	defer rows.Close()
	out := make([]tagDTO, 0)
	for rows.Next() {
		var x tagDTO
		var p *string
		if err := rows.Scan(&x.ID, &x.Name, &p); err != nil {
			writeError(w, 500, "scan_asset_tags_failed")
			return
		}
		x.ParentID = p
		out = append(out, x)
	}
	writeJSON(w, 200, map[string]any{"tags": out})
}
func (d Deps) replaceAssetTags(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	var req assetTagsRequest
	if json.NewDecoder(r.Body).Decode(&req) != nil || len(req.IDs) > 100 {
		writeError(w, 400, "invalid_tag_ids")
		return
	}
	id := chi.URLParam(r, "id")
	tx, err := d.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "update_tags_failed")
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM asset_tags WHERE asset_id=?`, id); err != nil {
		writeError(w, 500, "update_tags_failed")
		return
	}
	for _, tagID := range req.IDs {
		res, err := tx.ExecContext(r.Context(), `INSERT INTO asset_tags(asset_id,tag_id) SELECT ?,id FROM tags WHERE id=? AND owner_id=?`, id, tagID, user.ID)
		if err != nil {
			writeError(w, 500, "update_tags_failed")
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeError(w, 400, "invalid_tag")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, 500, "update_tags_failed")
		return
	}
	d.assetTags(w, r)
}

func (d Deps) listSavedSearches(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	rows, err := d.DB.QueryContext(r.Context(), `SELECT id,name,query_json,created_at FROM saved_searches WHERE owner_id=? ORDER BY name`, user.ID)
	if err != nil {
		writeError(w, 500, "query_saved_searches_failed")
		return
	}
	defer rows.Close()
	out := make([]savedSearchDTO, 0)
	for rows.Next() {
		var x savedSearchDTO
		if err := rows.Scan(&x.ID, &x.Name, &x.Query, &x.CreatedAt); err != nil {
			writeError(w, 500, "scan_saved_searches_failed")
			return
		}
		out = append(out, x)
	}
	writeJSON(w, 200, map[string]any{"saved_searches": out})
}
func (d Deps) createSavedSearch(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	var req savedSearchRequest
	if json.NewDecoder(r.Body).Decode(&req) != nil || !json.Valid(req.Query) {
		writeError(w, 400, "invalid_saved_search")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, 400, "saved_search_name_required")
		return
	}
	id, err := uuid.NewV7()
	if err != nil {
		writeError(w, 500, "saved_search_id_failed")
		return
	}
	if _, err = d.DB.ExecContext(r.Context(), `INSERT INTO saved_searches(id,owner_id,name,query_json) VALUES(?,?,?,?)`, id.String(), user.ID, req.Name, string(req.Query)); err != nil {
		writeError(w, 409, "saved_search_exists")
		return
	}
	writeJSON(w, 201, savedSearchDTO{ID: id.String(), Name: req.Name, Query: req.Query})
}
func (d Deps) deleteSavedSearch(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	res, err := d.DB.ExecContext(r.Context(), `DELETE FROM saved_searches WHERE id=? AND owner_id=?`, chi.URLParam(r, "id"), user.ID)
	if err != nil {
		writeError(w, 500, "delete_saved_search_failed")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, 404, "saved_search_not_found")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

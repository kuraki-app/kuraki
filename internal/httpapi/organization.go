package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// @Summary List tags
// @Tags    tags
// @Produce json
// @Success 200 {object} apitypes.TagList
// @Failure 401 {object} apitypes.Error
// @Router  /api/tags [get]
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
	out := make([]apitypes.Tag, 0)
	for rows.Next() {
		var x apitypes.Tag
		var p *string
		if err := rows.Scan(&x.ID, &x.Name, &p); err != nil {
			writeError(w, 500, "scan_tags_failed")
			return
		}
		x.ParentID = p
		out = append(out, x)
	}
	writeJSON(w, 200, apitypes.TagList{Tags: out})
}

// @Summary Create tag
// @Tags    tags
// @Accept  json
// @Produce json
// @Param   body body apitypes.TagRequest true "tag name + optional parent"
// @Success 201 {object} apitypes.Tag
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router  /api/tags [post]
func (d Deps) createTag(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	var req apitypes.TagRequest
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
	writeJSON(w, 201, apitypes.Tag{ID: id.String(), Name: req.Name, ParentID: req.ParentID})
}

// @Summary Delete tag
// @Tags    tags
// @Produce json
// @Param   id path string true "tag id"
// @Success 200 {object} map[string]string
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/tags/{id} [delete]
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

// @Summary List asset tags
// @Tags    tags
// @Produce json
// @Param   id path string true "asset id"
// @Success 200 {object} apitypes.TagList
// @Failure 401 {object} apitypes.Error
// @Router  /api/assets/{id}/tags [get]
func (d Deps) assetTags(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := d.DB.QueryContext(r.Context(), `SELECT t.id,t.name,t.parent_id FROM tags t JOIN asset_tags at ON at.tag_id=t.id WHERE at.asset_id=? ORDER BY t.name`, id)
	if err != nil {
		writeError(w, 500, "query_asset_tags_failed")
		return
	}
	defer rows.Close()
	out := make([]apitypes.Tag, 0)
	for rows.Next() {
		var x apitypes.Tag
		var p *string
		if err := rows.Scan(&x.ID, &x.Name, &p); err != nil {
			writeError(w, 500, "scan_asset_tags_failed")
			return
		}
		x.ParentID = p
		out = append(out, x)
	}
	writeJSON(w, 200, apitypes.TagList{Tags: out})
}

// @Summary Replace asset tags
// @Tags    tags
// @Accept  json
// @Produce json
// @Param   id   path string                     true "asset id"
// @Param   body body apitypes.AssetTagsRequest true "full tag id set"
// @Success 200 {object} apitypes.TagList
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Router  /api/assets/{id}/tags [put]
func (d Deps) replaceAssetTags(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	var req apitypes.AssetTagsRequest
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
	d.logAssetChange(r.Context(), id, user.ID, "update")
	d.assetTags(w, r)
}

// @Summary List saved searches
// @Tags    saved-searches
// @Produce json
// @Success 200 {object} apitypes.SavedSearchList
// @Failure 401 {object} apitypes.Error
// @Router  /api/saved-searches [get]
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
	out := make([]apitypes.SavedSearch, 0)
	for rows.Next() {
		var x apitypes.SavedSearch
		if err := rows.Scan(&x.ID, &x.Name, &x.Query, &x.CreatedAt); err != nil {
			writeError(w, 500, "scan_saved_searches_failed")
			return
		}
		out = append(out, x)
	}
	writeJSON(w, 200, apitypes.SavedSearchList{SavedSearches: out})
}

// @Summary Create saved search
// @Tags    saved-searches
// @Accept  json
// @Produce json
// @Param   body body apitypes.SavedSearchRequest true "name + query"
// @Success 201 {object} apitypes.SavedSearch
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Failure 409 {object} apitypes.Error
// @Router  /api/saved-searches [post]
func (d Deps) createSavedSearch(w http.ResponseWriter, r *http.Request) {
	user := d.currentUser(r)
	if user == nil {
		writeError(w, 401, "unauthorized")
		return
	}
	var req apitypes.SavedSearchRequest
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
	writeJSON(w, 201, apitypes.SavedSearch{ID: id.String(), Name: req.Name, Query: req.Query})
}

// @Summary Delete saved search
// @Tags    saved-searches
// @Produce json
// @Param   id path string true "saved search id"
// @Success 200 {object} map[string]string
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/saved-searches/{id} [delete]
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

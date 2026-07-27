package httpapi

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// stackAssets returns every member of an asset's stack (or just the asset if it
// is not stacked), so the viewer can page through a RAW+JPEG or Live/Motion pair.
// @Summary Get asset stack
// @Tags    assets
// @Produce json
// @Param   id path string true "asset id"
// @Success 200 {object} apitypes.AssetList
// @Failure 401 {object} apitypes.Error
// @Failure 404 {object} apitypes.Error
// @Router  /api/assets/{id}/stack [get]
func (d Deps) stackAssets(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	// Both the members and the stack_id lookup are owner-scoped: the inner
	// select must not resolve another owner's stack, or the existence of
	// their stacked asset would leak through the fallback below.
	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQL(`WHERE a.owner_id = ? AND a.deleted_at IS NULL AND a.stack_id IS NOT NULL
		 AND a.stack_id = (SELECT stack_id FROM assets WHERE id = ? AND owner_id = ?)`)+" LIMIT 500",
		owner, id, owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_stack_failed")
		return
	}
	assets, _, err := scanAssetRows(rows, 500)
	rows.Close()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "scan_stack_failed")
		return
	}
	if len(assets) == 0 {
		row, err := d.lookupAsset(r, id)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "asset_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "query_asset_failed")
			return
		}
		assets = []apitypes.Asset{row.toDTO()}
	}
	writeJSON(w, http.StatusOK, apitypes.AssetList{Assets: assets})
}

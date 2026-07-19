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
func (d Deps) stackAssets(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := d.DB.QueryContext(r.Context(),
		assetSelectSQL(`WHERE a.deleted_at IS NULL AND a.stack_id IS NOT NULL
		 AND a.stack_id = (SELECT stack_id FROM assets WHERE id = ?)`)+" LIMIT 500", id)
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

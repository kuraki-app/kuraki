package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
	"github.com/kuraki-app/kuraki/internal/trash"
)

const maxBatchIDs = 1000

// batchAssets applies one operation to many assets at once (multi-select — F-23).
// @Summary Batch asset operation
// @Tags    assets
// @Accept  json
// @Produce json
// @Param   body body apitypes.BatchRequest true "ids + operation"
// @Success 200 {object} apitypes.BatchResponse
// @Failure 400 {object} apitypes.Error
// @Failure 401 {object} apitypes.Error
// @Router  /api/assets/batch [post]
func (d Deps) batchAssets(w http.ResponseWriter, r *http.Request) {
	var req apitypes.BatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "no_ids")
		return
	}
	if len(req.IDs) > maxBatchIDs {
		writeError(w, http.StatusBadRequest, "too_many_ids")
		return
	}
	owner, ok := d.ownerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// logsHere is true for ops whose mutation doesn't already log a change_log
	// row itself. delete/restore route through trash.Delete/trash.Restore,
	// which already log — logging again here would double-log them.
	var apply func(context.Context, string) error
	var logsHere bool
	switch req.Op {
	case "delete":
		apply = func(ctx context.Context, id string) error { return trash.Delete(ctx, d.DB, d.Store, id) }
	case "restore":
		apply = func(ctx context.Context, id string) error { return trash.Restore(ctx, d.DB, d.Store, id) }
	case "favorite":
		apply = func(ctx context.Context, id string) error { return d.updateFavorite(ctx, id, true, owner) }
		logsHere = true
	case "unfavorite":
		apply = func(ctx context.Context, id string) error { return d.updateFavorite(ctx, id, false, owner) }
		logsHere = true
	case "archive":
		apply = func(ctx context.Context, id string) error {
			return d.updateLibraryState(ctx, id, "archived", true, owner)
		}
		logsHere = true
	case "unarchive":
		apply = func(ctx context.Context, id string) error {
			return d.updateLibraryState(ctx, id, "archived", false, owner)
		}
		logsHere = true
	case "hide":
		apply = func(ctx context.Context, id string) error {
			return d.updateLibraryState(ctx, id, "hidden", true, owner)
		}
		logsHere = true
	case "unhide":
		apply = func(ctx context.Context, id string) error {
			return d.updateLibraryState(ctx, id, "hidden", false, owner)
		}
		logsHere = true
	default:
		writeError(w, http.StatusBadRequest, "invalid_op")
		return
	}

	resp := apitypes.BatchResponse{Failed: map[string]string{}}
	for _, id := range req.IDs {
		if err := apply(r.Context(), id); err != nil {
			resp.Failed[id] = err.Error()
		} else {
			resp.Succeeded++
			if logsHere {
				d.logAssetChange(r.Context(), id, owner, "update")
			}
		}
	}
	if len(resp.Failed) == 0 {
		resp.Failed = nil
	}
	writeJSON(w, http.StatusOK, resp)
}

func (d Deps) updateLibraryState(ctx context.Context, id, column string, value bool, owner string) error {
	if column != "archived" && column != "hidden" {
		return fmt.Errorf("invalid library state")
	}
	v := 0
	if value {
		v = 1
	}
	res, err := d.DB.ExecContext(ctx, `UPDATE assets SET `+column+` = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, v, id, owner)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("asset not found")
	}
	return nil
}

// updateFavorite sets an asset's favorite flag, erroring if it does not exist
// or is not owned by the caller.
func (d Deps) updateFavorite(ctx context.Context, id string, fav bool, owner string) error {
	v := 0
	if fav {
		v = 1
	}
	res, err := d.DB.ExecContext(ctx,
		`UPDATE assets SET favorite = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, v, id, owner)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("asset not found")
	}
	return nil
}

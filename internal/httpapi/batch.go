package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kuraki-app/kuraki/internal/trash"
)

const maxBatchIDs = 1000

type batchRequest struct {
	IDs []string `json:"ids"`
	Op  string   `json:"op"` // delete | restore | favorite | unfavorite | archive | unarchive | hide | unhide
}

type batchResponse struct {
	Succeeded int               `json:"succeeded"`
	Failed    map[string]string `json:"failed,omitempty"`
}

// batchAssets applies one operation to many assets at once (multi-select — F-23).
func (d Deps) batchAssets(w http.ResponseWriter, r *http.Request) {
	var req batchRequest
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

	var apply func(context.Context, string) error
	switch req.Op {
	case "delete":
		apply = func(ctx context.Context, id string) error { return trash.Delete(ctx, d.DB, d.Store, id) }
	case "restore":
		apply = func(ctx context.Context, id string) error { return trash.Restore(ctx, d.DB, d.Store, id) }
	case "favorite":
		apply = func(ctx context.Context, id string) error { return d.updateFavorite(ctx, id, true) }
	case "unfavorite":
		apply = func(ctx context.Context, id string) error { return d.updateFavorite(ctx, id, false) }
	case "archive":
		apply = func(ctx context.Context, id string) error { return d.updateLibraryState(ctx, id, "archived", true) }
	case "unarchive":
		apply = func(ctx context.Context, id string) error { return d.updateLibraryState(ctx, id, "archived", false) }
	case "hide":
		apply = func(ctx context.Context, id string) error { return d.updateLibraryState(ctx, id, "hidden", true) }
	case "unhide":
		apply = func(ctx context.Context, id string) error { return d.updateLibraryState(ctx, id, "hidden", false) }
	default:
		writeError(w, http.StatusBadRequest, "invalid_op")
		return
	}

	resp := batchResponse{Failed: map[string]string{}}
	for _, id := range req.IDs {
		if err := apply(r.Context(), id); err != nil {
			resp.Failed[id] = err.Error()
		} else {
			resp.Succeeded++
		}
	}
	if len(resp.Failed) == 0 {
		resp.Failed = nil
	}
	writeJSON(w, http.StatusOK, resp)
}

func (d Deps) updateLibraryState(ctx context.Context, id, column string, value bool) error {
	if column != "archived" && column != "hidden" {
		return fmt.Errorf("invalid library state")
	}
	v := 0
	if value {
		v = 1
	}
	res, err := d.DB.ExecContext(ctx, `UPDATE assets SET `+column+` = ? WHERE id = ? AND deleted_at IS NULL`, v, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("asset not found")
	}
	return nil
}

// updateFavorite sets an asset's favorite flag, erroring if it does not exist.
func (d Deps) updateFavorite(ctx context.Context, id string, fav bool) error {
	v := 0
	if fav {
		v = 1
	}
	res, err := d.DB.ExecContext(ctx,
		`UPDATE assets SET favorite = ? WHERE id = ? AND deleted_at IS NULL`, v, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("asset not found")
	}
	return nil
}

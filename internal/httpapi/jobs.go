package httpapi

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type jobDTO struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Status     string `json:"status"`
	Total      int    `json:"total"`
	Imported   int    `json:"imported"`
	Duplicates int    `json:"duplicates"`
	Skipped    int    `json:"skipped"`
	Errors     int    `json:"errors"`
	Attempts   int    `json:"attempts"`
	Error      string `json:"error,omitempty"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

const jobColumns = `id, kind, status, total, imported, duplicates, skipped, errors, attempts, error, created_at, updated_at`

func scanJob(s interface{ Scan(...any) error }) (jobDTO, error) {
	var j jobDTO
	err := s.Scan(&j.ID, &j.Kind, &j.Status, &j.Total, &j.Imported, &j.Duplicates,
		&j.Skipped, &j.Errors, &j.Attempts, &j.Error, &j.CreatedAt, &j.UpdatedAt)
	return j, err
}

// listJobs returns recent import jobs (most recent first).
func (d Deps) listJobs(w http.ResponseWriter, r *http.Request) {
	rows, err := d.DB.QueryContext(r.Context(),
		`SELECT `+jobColumns+` FROM jobs ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_jobs_failed")
		return
	}
	defer rows.Close()
	jobs := make([]jobDTO, 0)
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "scan_jobs_failed")
			return
		}
		jobs = append(jobs, j)
	}
	writeJSON(w, http.StatusOK, map[string]any{"jobs": jobs})
}

// getJob returns one job's current status.
func (d Deps) getJob(w http.ResponseWriter, r *http.Request) {
	j, err := scanJob(d.DB.QueryRowContext(r.Context(),
		`SELECT `+jobColumns+` FROM jobs WHERE id = ?`, chi.URLParam(r, "id")))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "job_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_job_failed")
		return
	}
	writeJSON(w, http.StatusOK, j)
}

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

type jobError struct {
	Filename string `json:"filename"`
	Error    string `json:"error"`
}

type jobDetail struct {
	jobDTO
	ErrorsDetail []jobError `json:"errors_detail"`
}

// getJob returns one job's current status, including any per-file errors.
func (d Deps) getJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	j, err := scanJob(d.DB.QueryRowContext(r.Context(),
		`SELECT `+jobColumns+` FROM jobs WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "job_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query_job_failed")
		return
	}

	detail := jobDetail{jobDTO: j, ErrorsDetail: []jobError{}}
	rows, err := d.DB.QueryContext(r.Context(),
		`SELECT filename, error FROM job_errors WHERE job_id = ? ORDER BY id`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var e jobError
			if err := rows.Scan(&e.Filename, &e.Error); err == nil {
				detail.ErrorsDetail = append(detail.ErrorsDetail, e)
			}
		}
	}
	writeJSON(w, http.StatusOK, detail)
}

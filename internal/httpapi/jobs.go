package httpapi

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

const jobColumns = `id, kind, status, total, imported, duplicates, skipped, errors, attempts, error, created_at, updated_at`

func scanJob(s interface{ Scan(...any) error }) (apitypes.Job, error) {
	var j apitypes.Job
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
	jobs := make([]apitypes.Job, 0)
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "scan_jobs_failed")
			return
		}
		jobs = append(jobs, j)
	}
	writeJSON(w, http.StatusOK, apitypes.JobList{Jobs: jobs})
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

	detail := apitypes.JobDetail{Job: j, ErrorsDetail: []apitypes.JobError{}}
	rows, err := d.DB.QueryContext(r.Context(),
		`SELECT filename, error FROM job_errors WHERE job_id = ? ORDER BY id`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var e apitypes.JobError
			if err := rows.Scan(&e.Filename, &e.Error); err == nil {
				detail.ErrorsDetail = append(detail.ErrorsDetail, e)
			}
		}
	}
	writeJSON(w, http.StatusOK, detail)
}

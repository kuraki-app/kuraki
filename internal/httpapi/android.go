package httpapi

import (
	"net/http"
	"os"
)

// androidAPKFilename is the name browsers save the download as.
const androidAPKFilename = "kuraki-android.apk"

// downloadAndroid serves the operator-supplied Android app package as a file
// download. It is intentionally public (no session): a new phone fetches the
// APK from a browser before it has any credentials. When no APK has been placed
// on the server the endpoint returns a friendly 404 rather than an empty file.
func (d Deps) downloadAndroid(w http.ResponseWriter, r *http.Request) {
	if d.AndroidAPKPath == "" {
		writeError(w, http.StatusNotFound, "android_app_unavailable")
		return
	}
	f, err := os.Open(d.AndroidAPKPath)
	if err != nil {
		// Missing file is the common, expected case (no APK uploaded yet).
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "android_app_unavailable")
			return
		}
		writeError(w, http.StatusInternalServerError, "android_app_open_failed")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "android_app_unavailable")
		return
	}

	w.Header().Set("Content-Type", "application/vnd.android.package-archive")
	w.Header().Set("Content-Disposition", `attachment; filename="`+androidAPKFilename+`"`)
	// ServeContent handles range requests, conditional GETs, and Content-Length
	// from the file's size and mod time.
	http.ServeContent(w, r, androidAPKFilename, info.ModTime(), f)
}

package httpapi

import (
	"net"
	"net/http"
	"sort"
	"strings"

	"github.com/kuraki-app/kuraki/internal/httpapi/apitypes"
)

// lanAddresses returns the addresses a phone on the same network could actually
// reach this server on.
//
// The pairing screen used to build its address from `location.origin`, which is
// whatever the BROWSER typed — so an owner setting up on the same machine saw
// `http://127.0.0.1:3000` and was told, correctly but unhelpfully, that a phone
// using it would try to reach itself. The server is the only party that knows
// its own interfaces, so it is the one that should answer.
//
// Loopback, link-local and IPv6 are excluded: what is wanted is the one line
// someone can type into a phone, not an exhaustive interface dump.
func lanAddresses(port string) []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipNet.IP.To4()
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			out = append(out, "http://"+net.JoinHostPort(ip.String(), port))
		}
	}
	// Private ranges first: a machine on both a LAN and a VPN should offer the
	// address a phone in the house can actually route to.
	sort.SliceStable(out, func(i, j int) bool {
		return isPrivate(out[i]) && !isPrivate(out[j])
	})
	return out
}

func isPrivate(url string) bool {
	host := strings.TrimPrefix(url, "http://")
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsPrivate()
}

// serverAddresses reports the URLs a phone should be pointed at.
// @Summary Reachable server addresses
// @Tags    devices
// @Produce json
// @Success 200 {object} apitypes.ServerAddresses
// @Failure 401 {object} apitypes.Error
// @Router  /api/server-addresses [get]
func (d Deps) serverAddresses(w http.ResponseWriter, r *http.Request) {
	port := d.ListenPort
	if port == "" {
		port = "3000"
	}
	writeJSON(w, http.StatusOK, apitypes.ServerAddresses{Addresses: lanAddresses(port)})
}

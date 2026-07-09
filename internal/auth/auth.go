// Package auth contains the small password/session primitives used by the
// single-owner M1 setup flow.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argonTime    uint32 = 1
	argonMemory  uint32 = 32 * 1024
	argonThreads uint8  = 2
	argonKeyLen  uint32 = 32
	saltLen             = 16
	sessionLen          = 32
)

// HashPassword returns an argon2id encoded password hash.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: random salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory,
		argonTime,
		argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword compares password with an encoded argon2id hash.
func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 || parts[0] != "argon2id" || parts[1] != "v=19" {
		return false, fmt.Errorf("auth: unsupported password hash")
	}
	params, err := parseParams(parts[2])
	if err != nil {
		return false, err
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false, fmt.Errorf("auth: decode salt: %w", err)
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, fmt.Errorf("auth: decode hash: %w", err)
	}
	got := argon2.IDKey([]byte(password), salt, params.time, params.memory, params.threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// NewSessionID returns an opaque URL-safe session token.
func NewSessionID() (string, error) {
	b := make([]byte, sessionLen)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: random session: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

type argonParams struct {
	memory  uint32
	time    uint32
	threads uint8
}

func parseParams(s string) (argonParams, error) {
	out := argonParams{}
	for _, field := range strings.Split(s, ",") {
		key, value, ok := strings.Cut(field, "=")
		if !ok {
			return out, fmt.Errorf("auth: malformed argon2 params")
		}
		n, err := strconv.ParseUint(value, 10, 32)
		if err != nil {
			return out, fmt.Errorf("auth: parse argon2 param %s: %w", key, err)
		}
		switch key {
		case "m":
			out.memory = uint32(n)
		case "t":
			out.time = uint32(n)
		case "p":
			out.threads = uint8(n)
		default:
			return out, fmt.Errorf("auth: unknown argon2 param %s", key)
		}
	}
	if out.memory == 0 || out.time == 0 || out.threads == 0 {
		return out, fmt.Errorf("auth: incomplete argon2 params")
	}
	return out, nil
}

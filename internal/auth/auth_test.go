package auth

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestHashPasswordFormat(t *testing.T) {
	encoded, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 {
		t.Fatalf("encoded hash has %d $-sections, want 5: %q", len(parts), encoded)
	}
	if parts[0] != "argon2id" {
		t.Errorf("algorithm = %q, want argon2id", parts[0])
	}
	if parts[1] != "v=19" {
		t.Errorf("version = %q, want v=19", parts[1])
	}
	if parts[2] != "m=32768,t=1,p=2" {
		t.Errorf("params = %q, want m=32768,t=1,p=2", parts[2])
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		t.Errorf("salt not base64: %v", err)
	}
	if len(salt) != saltLen {
		t.Errorf("salt len = %d, want %d", len(salt), saltLen)
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		t.Errorf("key not base64: %v", err)
	}
	if len(key) != int(argonKeyLen) {
		t.Errorf("key len = %d, want %d", len(key), argonKeyLen)
	}
}

func TestHashPasswordUsesRandomSalt(t *testing.T) {
	a, err := HashPassword("same-password")
	if err != nil {
		t.Fatal(err)
	}
	b, err := HashPassword("same-password")
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Error("two hashes of the same password are identical — salt is not random")
	}
}

func TestVerifyPasswordRoundTrip(t *testing.T) {
	const pw = "s3cr3t-üñïçödé-password"
	encoded, err := HashPassword(pw)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := VerifyPassword(pw, encoded)
	if err != nil {
		t.Fatalf("VerifyPassword: %v", err)
	}
	if !ok {
		t.Error("correct password did not verify")
	}
}

func TestVerifyPasswordWrong(t *testing.T) {
	encoded, err := HashPassword("the-right-one")
	if err != nil {
		t.Fatal(err)
	}
	ok, err := VerifyPassword("the-wrong-one", encoded)
	if err != nil {
		t.Fatalf("VerifyPassword returned an error for a wrong password (should be false,nil): %v", err)
	}
	if ok {
		t.Error("wrong password verified as correct")
	}
}

func TestVerifyPasswordEmpty(t *testing.T) {
	encoded, err := HashPassword("")
	if err != nil {
		t.Fatal(err)
	}
	ok, err := VerifyPassword("", encoded)
	if err != nil || !ok {
		t.Errorf("empty password round-trip: ok=%v err=%v, want true,nil", ok, err)
	}
	ok, err = VerifyPassword("x", encoded)
	if err != nil || ok {
		t.Errorf("non-empty against empty-password hash: ok=%v err=%v, want false,nil", ok, err)
	}
}

func TestVerifyPasswordMalformed(t *testing.T) {
	// A valid RawStd base64 of a 4-byte "salt"/"hash" so cases that reach the
	// decode step have decodable sections.
	const b64 = "c2FsdA"
	cases := map[string]string{
		"empty":             "",
		"too few sections":  "argon2id$v=19$m=1,t=1,p=1$" + b64,
		"wrong algorithm":   "bcrypt$v=19$m=1,t=1,p=1$" + b64 + "$" + b64,
		"wrong version":     "argon2id$v=18$m=1,t=1,p=1$" + b64 + "$" + b64,
		"param without eq":  "argon2id$v=19$m1,t=1,p=1$" + b64 + "$" + b64,
		"param not numeric": "argon2id$v=19$m=NaN,t=1,p=1$" + b64 + "$" + b64,
		"unknown param":     "argon2id$v=19$z=1,t=1,p=1$" + b64 + "$" + b64,
		"incomplete params": "argon2id$v=19$m=0,t=1,p=1$" + b64 + "$" + b64,
		"bad salt base64":   "argon2id$v=19$m=1,t=1,p=1$!!!$" + b64,
		"bad hash base64":   "argon2id$v=19$m=1,t=1,p=1$" + b64 + "$!!!",
	}
	for name, encoded := range cases {
		t.Run(name, func(t *testing.T) {
			ok, err := VerifyPassword("whatever", encoded)
			if err == nil {
				t.Errorf("VerifyPassword(%q) returned nil error, want an error", encoded)
			}
			if ok {
				t.Errorf("VerifyPassword(%q) returned ok=true for a malformed hash", encoded)
			}
		})
	}
}

func TestNewSessionID(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id, err := NewSessionID()
		if err != nil {
			t.Fatalf("NewSessionID: %v", err)
		}
		if id == "" {
			t.Fatal("NewSessionID returned an empty string")
		}
		// URL-safe, unpadded base64 decoding back to sessionLen random bytes.
		raw, err := base64.RawURLEncoding.DecodeString(id)
		if err != nil {
			t.Fatalf("session id %q is not RawURL base64: %v", id, err)
		}
		if len(raw) != sessionLen {
			t.Errorf("session id decodes to %d bytes, want %d", len(raw), sessionLen)
		}
		if strings.ContainsAny(id, "+/=") {
			t.Errorf("session id %q contains non-URL-safe characters", id)
		}
		if seen[id] {
			t.Fatalf("NewSessionID produced a duplicate: %q", id)
		}
		seen[id] = true
	}
}

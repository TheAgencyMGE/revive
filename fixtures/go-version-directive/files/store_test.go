package main

import "testing"

func TestStorePutGet(t *testing.T) {
	s := NewStore()
	s.Put("a", "https://example.com")

	got, ok := s.Get("a")
	if !ok {
		t.Fatal("expected key to exist")
	}
	if got != "https://example.com" {
		t.Fatalf("got %q", got)
	}
	if s.Len() != 1 {
		t.Fatalf("expected 1 link, got %d", s.Len())
	}
}

func TestStoreMissing(t *testing.T) {
	s := NewStore()
	if _, ok := s.Get("nope"); ok {
		t.Fatal("expected miss")
	}
}

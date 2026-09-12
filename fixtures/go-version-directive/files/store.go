package main

import "sync"

// Store is a tiny in-memory key to URL map.
type Store struct {
	mu    sync.RWMutex
	links map[string]string
}

func NewStore() *Store {
	return &Store{links: make(map[string]string)}
}

func (s *Store) Put(key, target string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.links[key] = target
}

func (s *Store) Get(key string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	target, ok := s.links[key]
	return target, ok
}

func (s *Store) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.links)
}

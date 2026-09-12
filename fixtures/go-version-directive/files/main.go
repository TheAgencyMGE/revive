package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	store := NewStore()
	store.Put("go", "https://go.dev")

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		key := r.URL.Path[1:]
		target, ok := store.Get(key)
		if !ok {
			http.NotFound(w, r)
			return
		}
		http.Redirect(w, r, target, http.StatusFound)
	})

	fmt.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

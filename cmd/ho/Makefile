.PHONY: build test clean lint

build:
	go build -ldflags="-s -w" -o bin/ho .

test:
	go test -race ./...

clean:
	rm -rf bin/

lint:
	go vet ./...

### POST request to add questions in bulk

```bash
curl -X POST http://localhost:8787/api/questions/bulk \
  -H "Content-Type: application/json" \
  -d @example_questions_bulk.json
```

### Command to flush redis

```
docker exec -it mcqs-upgrade-redis-1 redis-cli FLUSHALL
```

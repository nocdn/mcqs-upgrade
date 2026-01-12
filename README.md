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

### Command to generate answer key

```bash
python3 -c "import random,sys;print(' '.join(str(random.randint(1,4))for _ in range(50)))"
```

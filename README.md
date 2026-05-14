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
python3 -c "import random; ask=lambda p,d:int(input(f'{p} [{d}]: ') or d); n=ask('How many questions?',50); b=ask('How many should have All of the above/etc []?',12); s=ask('How many of those should be correct [*]?',6); b=min(b,n); s=min(s,b); nums=[str(random.randint(1,4)) for _ in range(n)]; bracketed=set(random.sample(range(n),b)); starred=set(random.sample(list(bracketed),s)); print(' '.join(num+('[*]' if i in starred else '[]' if i in bracketed else '') for i,num in enumerate(nums)))"
```

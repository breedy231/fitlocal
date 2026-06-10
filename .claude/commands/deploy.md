Deploy the latest code to the production server.

Steps:

1. Run `npm run deploy` — this builds API + web, kills the running server on :3001, and restarts it.

2. Verify the server came up:
   `curl -s http://localhost:3001/api/workouts | python3 -c "import json,sys; d=json.load(sys.stdin); print('Up — latest workout:', d[0]['date'])"`

3. If the server didn't respond:
   - Check `lsof -i :3001` to see if anything is listening
   - Check `ps aux | grep "node.*server"` for the process
   - If the port is stuck: `lsof -ti :3001 | xargs kill -9` then manually run `node packages/api/dist/server.js &`

Report: whether the deploy succeeded and the API is responding.

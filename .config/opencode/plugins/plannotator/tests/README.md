# Tests

## Manual Tests

### Local Annotator Simulation (`manual/local/`)

Simulates the OpenCode annotator locally for testing the UI.

```bash
./tests/manual/local/test-bulk-plans.sh
```

Builds the annotator, pipes sample plans to the server, and opens the browser. Test approving/denying and check the output.

### SSH Remote Support (`manual/ssh/`)

Tests SSH session detection and port forwarding for remote development scenarios.

See [manual/ssh/DOCKER_SSH_TEST.md](manual/ssh/DOCKER_SSH_TEST.md) for setup instructions.

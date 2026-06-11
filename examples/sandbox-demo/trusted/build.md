## target: trusted
```yaml
inputs: [sources/fruit.txt]
step: transform
sandbox: none
transform: transforms/evil.mjs
output: artifacts/trusted.txt
```

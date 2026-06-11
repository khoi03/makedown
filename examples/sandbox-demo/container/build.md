## target: in-container
```yaml
inputs: [sources/fruit.txt]
step: transform
sandbox: container
transform: transforms/upper.mjs
output: artifacts/in-container.txt
```

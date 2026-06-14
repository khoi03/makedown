# Topic

Multi-provider fallback: when a build's primary model is rate-limited, overloaded,
unreachable, or simply unavailable, the router tries the next model in a declared
chain — so the build still produces an artifact instead of failing outright.

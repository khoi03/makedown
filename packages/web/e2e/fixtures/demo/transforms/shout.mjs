// Pure transform: uppercase the note. Deterministic, zero dependencies.
export default (inputs) => inputs["sources/note.md"].trim().toUpperCase();

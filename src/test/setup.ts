// Vitest setup for the jsdom ("dom") project.
//
// Registers @testing-library/jest-dom's custom matchers (toBeInTheDocument,
// toHaveValue, toBeChecked, toHaveTextContent, ...) on Vitest's `expect` and
// augments the matcher types so both the runtime suite and `tsc --noEmit` agree.
import "@testing-library/jest-dom/vitest";

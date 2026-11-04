import { add } from "../add.mjs"
const cases = [[1, 2, 3], [0, 0, 0], [-1, 1, 0]]
const passed = cases.filter(([a, b, r]) => add(a, b) === r).length
console.log("some noise")
console.log(JSON.stringify({ passed, total: cases.length, details: `${passed}/${cases.length}` }))

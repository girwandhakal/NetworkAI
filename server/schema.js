/**
 * A tiny, provider-agnostic schema builder. Each provider module (openai.js)
 * translates this shape into whatever dialect its structured-output API
 * actually wants — prompts.js just describes fields once, here.
 */
export const S = {
  str: (description) => ({ type: 'STRING', description }),
  num: (description) => ({ type: 'NUMBER', description }),
  enum: (values, description) => ({ type: 'STRING', enum: values, description }),
  obj: (properties, required) => ({ type: 'OBJECT', properties, required: required || Object.keys(properties) }),
  arr: (items, description) => ({ type: 'ARRAY', items, description }),
}

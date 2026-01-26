if (process.env.NODE_ENV !== 'production') {
  throw new Error('dev-only error in consequent');
}
if ('production' !== process.env.NODE_ENV) {
  throw new Error('reversed operands');
}
if (process.env.NODE_ENV === 'production') {
  // production branch
} else {
  throw new Error('dev-only error in alternate');
}
if (process.env.NODE_ENV !== 'production') {
  for (let i = 0; i < 10; i++) {
    throw new Error('nested inside dev branch');
  }
}
if (a) {
  // unrelated branch
} else if (process.env.NODE_ENV !== 'production') {
  throw new Error('else-if with valid guard');
}
function foo(render) {
  if (render) {
    const newElement = render;
    if (process.env.NODE_ENV !== 'production') {
      if (!React.isValidElement(newElement)) {
        throw new Error('invalid element provided');
      }
    }
  }
}

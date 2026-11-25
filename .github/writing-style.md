# MUI writing style

How MUI writes its docs, blog posts and other prose. Each section is one rule: what it asks for, why,
and where it doesn't apply. It is written for people and for agents alike; an agent reviewing or
writing MUI prose can be pointed at this file or at one of its sections.

The rules describe intent. Apply them with judgment: a rule that would make a sentence wrong or
awkward doesn't apply to it.

## Where the rules apply

Hand-written prose in Markdown and MDX. Leave alone what isn't prose: code blocks and inline code,
component, prop and package names, links and their targets, front matter, JSX, and demo or API
references such as `{{"demo": "BasicButton.js"}}`.

Changelogs record what was written at the time, so they are exempt from [US spelling](#us-spelling),
[Names spelled one way](#names-spelled-one-way) and [No Latin abbreviations](#no-latin-abbreviations).
Agent instruction files, such as skills, are exempt from every rule here.

## Brand names take a non-breaking space

Write the space inside an MUI brand name as a non-breaking space (U+00A0), so a line never breaks in
the middle of the name: Material UI, MUI X, Base UI, MUI Base, MUI System, MUI Store, MUI Core,
MUI Connect, Pigment CSS. The character looks like a space; type it with Option+Space on macOS,
Alt+0160 on Windows or AltGr+Space on Linux.

Toolpad is just "Toolpad", never "MUI Toolpad".

## Name the product or the team, not the company

Don't use "MUI" for the company, as in "MUI recommends" or "MUI's engineers". Name the product
("Material UI recommends") or the people ("the MUI team"). "MUI" is fine as part of a product name
from [Brand names take a non-breaking space](#brand-names-take-a-non-breaking-space), and in "MUI
organization", "MUI ecosystem", "MUI products" and "MUI team", which take an ordinary space.

## US spelling

Use US English: color, behavior, gray, center, license, labeled, modeling, traveling, analyze,
optimize, organize, defense, catalog, program. This covers the whole family of British forms (-our,
-re, -ise, -yse, doubled consonants before -ed and -ing, -ence for -ense), not just these words.

## Names spelled one way

Write these the way their owners do, whatever the position in the sentence:

- API, CSS, HTML, JavaScript and TypeScript; spell out "JS" and "TS" in prose.
- npm, lowercase even at the start of a sentence; webpack, lowercase.
- GitHub, Stack Overflow, VS Code, CodeSandbox, StackBlitz, ESLint, Tailwind CSS, CSS Modules,
  ES modules.
- Next.js's App Router and Pages Router.
- Material Design 3, not "Material 3".
- Chart names: Heatmap, Treemap, Sparkline chart, Gauge chart, Treemap chart.
- subcomponent, use case.

## No Latin abbreviations

Write "for example" instead of "e.g." and "that is" instead of "i.e.", in any spelling ("eg", "ie.").
Many readers don't know the abbreviations or mix them up.

## Address the reader as "you"

Write to the reader, not about the authors: "you can pass a theme", not "we pass a theme" or "I
recommend". "We" is fine for the MUI team speaking as itself, such as in a blog post announcing its
own decision.

## Present tense

Describe what happens, not what will happen: "the button renders a ripple", not "the button will
render a ripple". Keep the future for things that are actually in the future, such as a planned
release.

## Gender-neutral language

Use "they" for a person of unknown gender, and gender-neutral words for roles and groups: "people",
"developers", "staffed", not "guys", "manpower" or "he or she".

## Oxford comma

In a list of three or more, put a comma before the final "and" or "or": "colors, spacing, and
typography".

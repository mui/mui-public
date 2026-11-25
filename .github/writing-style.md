# Writing style

How the MUI team writes its docs, blog posts, and other prose.
Each section is one rule: what it asks for, why, and where it doesn't apply.
It is written for people and for agents alike; an agent reviewing or writing for MUI products can be pointed at this file or at one of its sections.

The rules describe intent.
Apply them with judgment: a rule that would make a sentence wrong or awkward doesn't apply to it.

They are the ones a reader can check line by line, drawn from the [DevEx writing style guide](https://mui-org.notion.site/DevEx-Writing-style-guide-2a957a4168a54d47b14bae026d06a24b), which also covers numbers, dates, and punctuation for blog posts.
How a whole page should read, such as its structure, reading level, and when to split it, is in the [DevEx technical writing style guide](https://mui-org.notion.site/DevEx-Technical-writing-style-guide-7e55b517ac2e489a9ddb6d0f6dd765de).

## Where the rules apply

Hand-written prose in Markdown and MDX.
Leave alone what isn't prose: code blocks and inline code, component, prop and package names, links and their targets, front matter, JSX, and demo or API references such as `{{"demo": "BasicButton.js"}}`.

Changelogs record what was written at the time, so they are exempt from [US spelling](#us-spelling), [Names spelled one way](#names-spelled-one-way), and [No Latin abbreviations](#no-latin-abbreviations).
Agent instruction files, such as skills, are exempt from every rule here.

## Brand names take a non-breaking space

Write the space inside an MUI brand name as a non-breaking space (U+00A0), so a line never breaks in the middle of the name: Material UI, MUI X, Base UI, MUI Base, MUI System, MUI Store, MUI Core, MUI Connect, and Pigment CSS.
The character looks like a space; type it with Option+Space on macOS, Alt+0160 on Windows, or AltGr+Space on Linux.

Toolpad is just "Toolpad", never "MUI Toolpad".

## Name the product or the team, not the company

Don't use "MUI" for the company, as in "MUI recommends" or "MUI's engineers".
Name the product ("Material UI recommends") or the people ("the MUI team").
"MUI" is fine as part of a product name from [Brand names take a non-breaking space](#brand-names-take-a-non-breaking-space), and in "MUI organization", "MUI ecosystem", "MUI products", and "MUI team", which take an ordinary space.

## US spelling

Use US English: color, behavior, gray, center, license, labeled, modeling, traveling, analyze, optimize, organize, defense, catalog, program.
This covers the whole family of British forms (-our, -re, -ise, -yse, doubled consonants before -ed and -ing, -ence for -ense), not just these words.

## Names spelled one way

Write these the way their owners do, whatever the position in the sentence:

- API, CSS, HTML, JavaScript, and TypeScript; spell out "JS" and "TS" in prose.
- npm, lowercase even at the start of a sentence; webpack, lowercase.
- GitHub, Stack Overflow, VS Code, CodeSandbox, StackBlitz, ESLint, Tailwind CSS, CSS Modules, ES modules.
- Next.js's App Router and Pages Router.
- Material Design 3, not "Material 3".
- Chart names: Heatmap, Treemap, Sparkline chart, Gauge chart, and Treemap chart.
- subcomponent, use case.

## No Latin abbreviations

Write "for example" instead of "e.g." and "that is" instead of "i.e.", in any spelling ("eg", "ie.").
Many readers don't know the abbreviations or mix them up.

## Address the reader as "you"

Write to the reader, not about the authors: "you can pass a theme", not "we pass a theme" or "the user can pass a theme".
The people using what the reader builds are "your users".
Keep "we" for a recommendation ("we recommend the `sx` prop") and for the MUI team speaking as itself, such as in a blog post announcing its own decision; never "I".

## Active voice

Make the subject of the sentence the one that acts: "the theme sets the color", not "the color is set by the theme".
Use the passive when the actor doesn't matter or when the active would need "we": "each grouped column is shown in its own column", not "each column we group is shown in its own column".

## "Lets you", not "allows you to"

Write "the API lets you set the default theme", not "allows you to" or "enables you to".
Keep "enable" for turning a feature on: "to enable the API, click the toggle".

## Contractions are welcome

"Don't", "it's", and "you'll" make the text friendlier.
Don't expand them, and don't ask for them where the author wrote the full form.

## Present tense

Describe what happens, not what will happen: "the button renders a ripple", not "the button will render a ripple".
This holds for boolean props too: "if `true`, the accordion is disabled", not "will be disabled".
Keep the future for things that are actually in the future, such as a planned release.

## Inclusive language

Use "they" for a person of unknown gender, and gender-neutral words for roles and groups: "people", "developers", "staffed", not "guys", "manpower" or "he or she".
Avoid ableist and otherwise excluding words, such as "crazy", "sanity check", or "blind to", and don't call people "ninjas", "rockstars", or "gurus".

## Headings in sentence case

Capitalize only the first word of a heading and the proper nouns in it: "Customization demos", not "Customization Demos".
Name a component in the singular where it reads naturally: "Button size", not "Buttons size".

## Code in backticks

Write JavaScript identifiers, props, CSS properties, and file names in code font, and put `()` after a function's name to show that it's one: "use `theme.applyStyles()`".
In React, they are "props", not "properties"; an HTML attribute is an "attribute", not a "property".

## UI elements in bold

Write the name of a UI element the reader interacts with in bold, as it is labeled: "click **Save**", not "click the 'Save' button" or "click `Save`".
Product names aren't bold.

## Helpful link text

The text of a link says where it goes: "read the [theming guide](/material-ui/customization/theming/)", not "[click here](/material-ui/customization/theming/)".
Screen reader users often move from link to link without the sentence around them.

## Hyphens and dashes

Use a hyphen to join words into one modifier ("a first-time user"), an en dash for ranges ("20–30 days"), and an em dash without spaces for an aside ("the prop—new in v7—sets the size"), never two hyphens.

## One sentence per line

In Markdown, start each sentence on a new line.
The rendered paragraph is the same, and a review can comment on one sentence at a time.

## Oxford comma

In a list of three or more, put a comma before the final "and" or "or": "colors, spacing, and typography".

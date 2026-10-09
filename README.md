# Etymology Editor

Latest Deployment: https://etymology-translator.lkbm.workers.dev/

Years ago, I had the thought that you could add an interesting tone to character dialog by having certain characters speak in mostly-Anglo-Saxon derived words, or mostly-Latin-based words, etc.

But doing that manually is hard! (I do recommend considering doing it by hand if you want to develop a "feel" for etymology.)

So this is a simple text editor that will highlight each word based on the language of origin (where able). It has a fairly small (<50k word) dictionary, and many words are multi-lingual ("sociology" gets "socio" from Latin and and "ology" from Greek.)

I've also added a thesaurus feature so you can ask it for, e.g., an Anglo-Saxon alternative to the French-based word you used.

## Technology
This is abuilt with Preact, TypeScript, Vite, and Cloudflare Workers, with Claude Code used for much of the coding.

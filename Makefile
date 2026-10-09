.PHONY: deploy dev build format lint

build:
	npm run build

dev:
	npx cf dev

deploy:
	npx cf deploy

format:
	oxfmt --config=/Users/luca/dotfiles/.oxfmtrc.json

lint:
	oxlint

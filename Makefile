.PHONY : install deploy githook dependencies pull

install: dependencies

deploy: pull dependencies

githook: pull dependencies

dependencies:
	yarn install --production --no-progress

pull:
	git reset --hard HEAD --quiet
	git pull --quiet

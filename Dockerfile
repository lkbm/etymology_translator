FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
	curl \
	ca-certificates \
	&& curl -fsSL https://claude.ai/install.sh | bash \
	&& rm -rf /var/lib/apt/lists/*

RUN useradd -m claude
USER claude

WORKDIR /workspace

RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/claude/.local/bin:${PATH}"
CMD ["/bin/bash", "-c", "source ~/.claude/.env && exec claude"]

# To build:
# docker build -t claude-code-sandbox .
# To run:
# docker run -it -v $(pwd):/workspace -v ~/.claude:/home/claude/.claude claude-code-sandbox

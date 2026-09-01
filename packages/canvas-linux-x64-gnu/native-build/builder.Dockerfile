# syntax=docker.io/docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# This image is a pinned derivation used only to build the Life Links-owned
# Linux x64 glibc @napi-rs/canvas binding. The native build itself runs with
# networking disabled against the separately locked material bundle.
ARG CANVAS_BUILDER_BASE=ghcr.io/brooooooklyn/canvas/ubuntu-builder@sha256:1388d2ba01f422282a80919aefc1d53e0d70ccab93b9470a70d55c9e6164a5a0
FROM ${CANVAS_BUILDER_BASE}

ARG RUST_TOOLCHAIN=1.94.1-x86_64-unknown-linux-gnu
RUN rustup set auto-self-update disable \
    && rustup set profile minimal \
    && rustup toolchain install "${RUST_TOOLCHAIN}" \
    && rustup default "${RUST_TOOLCHAIN}" \
    && rustc --version --verbose \
    && cargo --version --verbose

ENV RUSTUP_TOOLCHAIN=1.94.1-x86_64-unknown-linux-gnu

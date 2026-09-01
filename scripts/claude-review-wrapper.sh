#!/bin/sh

# Keep Claude subscription OAuth, but disable all user/project customizations,
# MCP servers, hooks, skills, agents, and CLAUDE.md for plan-review chat turns.
exec claude --safe-mode "$@"

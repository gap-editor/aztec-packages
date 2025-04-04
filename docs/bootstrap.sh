#!/usr/bin/env bash
source $(git rev-parse --show-toplevel)/ci3/source_bootstrap

cmd=${1:-}

# We search the docs/*.md files to find included code, and use those as our rebuild dependencies.
# We prefix the results with ^ to make them "not a file", otherwise they'd be interpreted as pattern files.
hash=$(
  cache_content_hash \
    .rebuild_patterns \
    $(find docs versioned_docs -type f -name "*.md*" -exec grep '^#include_code' {} \; |
      awk '{ print "^" $1 }' | sort -u)
)

if semver check $REF_NAME; then
  # Ensure that released versions don't use cache from non-released versions (they will have incorrect links to master)
  hash+=$REF_NAME
  export COMMIT_TAG=$REF_NAME
fi

function build_and_preview {
  if [ "${CI:-0}" -eq 1 ] && [ $(arch) == arm64 ]; then
    echo "Not building docs for arm64 in CI."
    return
  fi
  echo_header "build docs"
  if cache_download docs-$hash.tar.gz; then
    return
  fi
  npm_install_deps
  denoise "yarn build"
  cache_upload docs-$hash.tar.gz build

  if [ "${CI:-0}" -eq 1 ] && [ "$(arch)" == "amd64" ]; then
    # Included as part of build step so we can skip this consistently if the build was cached.
    release_preview
  fi
}

# If we're an AMD64 CI run and have a PR, do a preview release.
function release_preview {
  echo_header "docs release preview"

  # Deploy and capture exit code and output.
  if ! deploy_output=$(yarn netlify deploy --site aztec-docs-dev 2>&1); then
    echo "Netlify deploy failed with error:"
    echo "$deploy_output"
    exit 1
  fi

  # Extract preview URL.
  local docs_preview_url=$(echo "$deploy_output" | grep -E "https://.*aztec-docs-dev.netlify.app" | awk '{print $4}')
  if [ -z "$docs_preview_url" ]; then
    echo "Failed to extract preview URL from Netlify output."
  else
    echo "Docs preview URL: ${docs_preview_url}"
  fi

  local pr_number=$(gh pr list --head "$REF_NAME" --json number --jq '.[0].number')
  if [ -n "$pr_number" ]; then
    if [ -z "${GITHUB_TOKEN:-}" ]; then
      echo_stderr "Not updating docs preview comment; no PR number."
      return
    fi
    # We remove color from the URL before passing.
    scripts/docs_preview_comment.sh $GITHUB_TOKEN $pr_number "$(echo $docs_preview_url | sed -r 's/\x1B\[[0-9;]*[a-zA-Z]//g')"
  fi
}

function release {
  echo_header "docs release"

  # If we download cached docs, we may not have netlify CLI in node_modules. Install in case.
  yarn install

  if [ $(dist_tag) != "latest" ]; then
    # TODO attach to github release
    do_or_dryrun yarn netlify deploy --site aztec-docs-dev
  else
    do_or_dryrun yarn netlify deploy --site aztec-docs-dev --prod
  fi
}

case "$cmd" in
  "clean")
    git clean -fdx
    ;;
  ""|"full"|"fast")
    build_and_preview
    ;;
  "hash")
    echo "$hash"
    ;;
  "release-preview")
    release_preview
    ;;
  "release")
    release
    ;;
  "docs-release")
    release
    ;;
  *)
    echo "Unknown command: $cmd"
    exit 1
esac

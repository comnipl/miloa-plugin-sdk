import { definePlugin, useTags } from '@comnipl/miloa-plugin-sdk/react';

function TagCount() {
  const { tags, loading, error } = useTags();

  if (loading) return <p>Loading tags…</p>;
  if (error) return <p>Could not load tags.</p>;
  return <p>Tags: {tags.length}</p>;
}

definePlugin({ View: TagCount });

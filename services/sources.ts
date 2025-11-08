type AskSource = {
  sourceType?: unknown;
  url?: unknown;
  title?: unknown;
};

function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_`\[\]\(\)])/g, '\\$1');
}

export function buildSourcesMessage(sources: unknown): string | undefined {
  if (!Array.isArray(sources)) {
    return undefined;
  }

  const seenUrls = new Set<string>();
  const formattedSources: { title: string; url: string }[] = [];

  for (const rawSource of sources) {
    if (!rawSource || typeof rawSource !== 'object') {
      continue;
    }

    const { sourceType, url, title } = rawSource as AskSource;
    if (sourceType !== 'url' || typeof url !== 'string') {
      continue;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl || seenUrls.has(trimmedUrl)) {
      continue;
    }

    seenUrls.add(trimmedUrl);

    let displayTitle = typeof title === 'string' && title.trim() !== '' ? title.trim() : undefined;
    if (!displayTitle) {
      try {
        const parsedUrl = new URL(trimmedUrl);
        displayTitle = parsedUrl.hostname ?? trimmedUrl;
      } catch {
        displayTitle = trimmedUrl;
      }
    }

    formattedSources.push({
      title: escapeMarkdown(displayTitle),
      url: trimmedUrl,
    });
  }

  if (formattedSources.length === 0) {
    return undefined;
  }

  const lines = formattedSources.map(({ title, url }) => `- [${title}](${url})`);

  return ['🙏 Gracias por tu pregunta. Aquí encuentras las fuentes consultadas:', '', ...lines].join('\n');
}

import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			// The front page's setup, copied from the README by the importer: the
			// shell commands, and the one sentence to say to Claude Code after.
			extend: z.object({
				install: z.array(z.string()).optional(),
				ask: z.string().nullish(),
			}),
		}),
	}),
};

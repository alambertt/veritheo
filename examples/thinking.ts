import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

const { text, reasoning } = await generateText({
  model: google('gemini-2.5-flash'),
  prompt: 'What is the sum of the first 10 prime numbers?',
  providerOptions: {
    google: {
      thinkingConfig: {
        thinkingBudget: 8192,
        includeThoughts: true,
      },
    },
  },
});

console.log(text); // text response
console.log(reasoning); // reasoning summary

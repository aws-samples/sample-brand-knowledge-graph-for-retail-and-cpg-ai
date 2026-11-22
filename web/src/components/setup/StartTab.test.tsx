// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExampleInfo } from '../../api';
import { MeetTheBrand } from './StartTab';
import { visibleText } from '../../visibleText';

/** The box as a reader sees it: tags dropped, the escaped characters back. */
const text = (html: string) => visibleText(html);

const apparel = { name: 'AnyCompany Apparel', description: 'AnyCompany Apparel is a contemporary label built on three lines.' };
const fashionHouse = { name: 'AnyCompany Fashion House', description: 'A fictional luxury brand.' };
const photo = (file: string, batch?: string) => ({ file, title: file, ...(batch ? { batch } : {}) }) as ExampleInfo;

describe('MeetTheBrand (tab 0)', () => {
  it('names every brand of the graph with its description and the counts it has read', () => {
    const html = text(renderToStaticMarkup(<MeetTheBrand brands={[apparel, fashionHouse]} looks={20} products={62} examples={[photo('01.jpg', 'first'), photo('02.jpg')]} />));
    expect(html).toContain('Meet the brands: AnyCompany Apparel and AnyCompany Fashion House');
    expect(html).toContain('AnyCompany Apparel is a contemporary label built on three lines.');
    // a description that does not say the name is led by it
    expect(html).toContain('AnyCompany Fashion House: A fictional luxury brand.');
    expect(html).toContain("The stylists' taste is in the brands' lookbooks: 20 looks, already in the graph as each brand's style DNA");
    expect(html).toContain('The catalog of 62 products sits in a separate vector store.');
    expect(html).toContain('Image models on Amazon Bedrock made the photos.');
    expect(html).not.toContain('new shoot');
    expect(html).toContain('This sample uses fashion');
  });

  it('says the new shoot only with new-shoot photos, with their count', () => {
    const examples = [photo('a.jpg', 'new-shoot'), photo('b.jpg', 'new-shoot'), photo('c.jpg', 'new-work')];
    const html = text(renderToStaticMarkup(<MeetTheBrand brands={[apparel]} looks={120} products={527} examples={examples} />));
    expect(html).toContain('Meet the brand: AnyCompany Apparel');
    expect(html).toContain("The stylists' taste is in the lookbook: 120 looks, already in the graph as the brand's style DNA");
    expect(html).toContain('A new shoot of 2 looks is waiting for you to add in tab 2.');
  });

  it('leaves out what it has not read yet, with no stand-in count, brand or shoot', () => {
    const html = text(renderToStaticMarkup(<MeetTheBrand brands={[]} looks={undefined} products={null} examples={null} />));
    expect(html).toContain('Meet the brand');
    expect(html).not.toContain('Meet the brand:');
    expect(html).toContain("The stylists' taste is in the lookbook, already in the graph as the brand's style DNA");
    expect(html).toContain('The catalog sits in a separate vector store.');
    expect(html).not.toMatch(/\d/);
    expect(html).not.toContain('new shoot');
    expect(html).not.toContain('image model');
  });

  it('says nothing of how photos were made when the domain has none', () => {
    const html = text(renderToStaticMarkup(<MeetTheBrand brands={[{ name: 'AnyCompany Apparel', description: '' }]} looks={19} products={55} examples={[]} />));
    expect(html).toContain('Meet the brand: AnyCompany Apparel');
    expect(html).not.toContain('AnyCompany Apparel:');
    expect(html).not.toContain('image model');
  });
});

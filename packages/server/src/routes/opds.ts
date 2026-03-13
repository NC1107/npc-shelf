import { Router } from 'express';
import { opdsAuthMiddleware } from '../middleware/opds-auth.js';

export const opdsRouter = Router();

// All OPDS routes use HTTP Basic auth
opdsRouter.use(opdsAuthMiddleware);

// Root navigation feed
opdsRouter.get('/', (_req, res) => {
  res.type('application/atom+xml;profile=opds-catalog;kind=navigation');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:npc-shelf:root</id>
  <title>NPC-Shelf</title>
  <updated>${new Date().toISOString()}</updated>
  <link rel="self" href="/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="start" href="/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="search" href="/opds/search?q={searchTerms}" type="application/atom+xml" title="Search"/>
  <entry>
    <title>Recent Books</title>
    <id>urn:npc-shelf:recent</id>
    <link href="/opds/recent" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
    <updated>${new Date().toISOString()}</updated>
    <content type="text">Recently added books</content>
  </entry>
  <entry>
    <title>Authors</title>
    <id>urn:npc-shelf:authors</id>
    <link href="/opds/authors" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
    <updated>${new Date().toISOString()}</updated>
    <content type="text">Browse by author</content>
  </entry>
  <entry>
    <title>Series</title>
    <id>urn:npc-shelf:series</id>
    <link href="/opds/series" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
    <updated>${new Date().toISOString()}</updated>
    <content type="text">Browse by series</content>
  </entry>
</feed>`);
});

// TODO: Implement remaining OPDS routes (recent, authors, series, collections, search)

opdsRouter.get('/recent', (_req, res) => {
  res.type('application/atom+xml;profile=opds-catalog;kind=acquisition');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:npc-shelf:recent</id>
  <title>Recent Books</title>
  <updated>${new Date().toISOString()}</updated>
</feed>`);
});

opdsRouter.get('/search', (_req, res) => {
  res.type('application/atom+xml;profile=opds-catalog;kind=acquisition');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:npc-shelf:search</id>
  <title>Search Results</title>
  <updated>${new Date().toISOString()}</updated>
</feed>`);
});

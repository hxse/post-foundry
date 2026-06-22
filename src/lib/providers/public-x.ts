export type PublicXSearchInput = {
  query: string;
  limit: number;
};

export type PublicXPostSnapshot = {
  id: string;
  text: string;
  authorHandle?: string;
  authorId?: string;
  createdAt?: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  url?: string;
};

export type PublicXSearchOutput = {
  posts: PublicXPostSnapshot[];
  sourceProvider: "twitterapi.io";
  rawCount: number;
};

export interface PublicXDataProvider {
  searchPosts(input: PublicXSearchInput): Promise<PublicXSearchOutput>;
  getPostById(id: string): Promise<PublicXPostSnapshot | undefined>;
}

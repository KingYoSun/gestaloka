function(ctx) {
  requestUrl: ctx.flow.request_url,
  flow: ctx.flow.id,
  receipt: std.get(ctx.request_cookies, 'gestaloka_registration_consent', null),
}

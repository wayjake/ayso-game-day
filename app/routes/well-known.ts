// Handle Chrome DevTools and other .well-known requests silently
export async function loader() {
  return new Response(null, { status: 204 });
}

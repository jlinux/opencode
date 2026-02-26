export default function Loading() {
  return (
    <div class="flex h-screen w-screen items-center justify-center bg-black">
      <div class="flex flex-col items-center gap-4">
        <div class="size-12 animate-spin rounded-full border-4 border-gray-700 border-t-white" />
        <p class="text-sm text-gray-400">Starting Data Analysis...</p>
      </div>
    </div>
  )
}

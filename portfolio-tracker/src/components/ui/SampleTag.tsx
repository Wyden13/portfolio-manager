/** Marks a panel whose numbers are sample data: there is no live source for them yet. */
export function SampleTag({ what = 'This panel' }: { what?: string }) {
  return (
    <span className="sample" title={`${what} shows sample data. There is no live source for it yet.`}>Sample</span>
  )
}

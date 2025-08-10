// api/analyze.js
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Analyzer is alive. POST audio here.' });
  }
  return res.status(200).json({ ok: true, echo: { method: req.method } });
};
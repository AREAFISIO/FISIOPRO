module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    message: "PING OK",
    time: new Date().toISOString()
  });
};
